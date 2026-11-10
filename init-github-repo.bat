@echo off
chcp 65001 >nul
echo ============================================================================
echo   QuantPulse — تبدیل خودکار پوشه به ریپازیتوری استاندارد گیت و گیت‌هاب
echo ============================================================================
echo.

REM 1. Ensure .github/workflows exists (in case ZIP exporter stripped dot-folders)
if not exist ".github\workflows" (
    mkdir ".github\workflows"
)
if exist "github-workflows\scan.yml" (
    copy /Y "github-workflows\*.yml" ".github\workflows\" >nul
    echo [OK] فایل‌های ورک‌فلوی GitHub Actions (.github/workflows) بازسازی شدند.
)

REM 2. Initialize Git repository on branch main if not already initialized
if not exist ".git" (
    git init -b main
    echo [OK] مخزن گیت (.git) روی شاخه main ایجاد شد.
) else (
    git branch -M main
    echo [OK] مخزن گیت (.git) از قبل فعال است.
)

REM 3. Stage and commit all files
git add .
git commit -m "feat: QuantPulse crypto, pump hunter, forex & gold signal bot" 2>nul
echo [OK] تمامی فایل‌های پروژه در مخزن Git ثبت (Commit) شدند.
echo.
echo اکنون این پوشه یک ریپازیتوری کامل گیت است و می‌توانید:
echo   1) در برنامه GitHub Desktop گزینه Add Existing Repository را بزنید و همین پوشه را انتخاب کنید.
echo   2) یا آدرس ریپازیتوری گیت‌هاب خود را در زیر وارد کنید تا مستقیماً Push شود:
echo.
set /p REPO_URL="آدرس ریپازیتوری گیت‌هاب (مثلاً https://github.com/USERNAME/quantpulse.git) یا Enter برای خروج: "
if not "%REPO_URL%"=="" (
    git remote remove origin 2>nul
    git remote add origin %REPO_URL%
    git push -u origin main
    echo.
    echo [OK] پروژه با موفقیت به گیت‌هاب شما ارسال (Push) شد!
)
echo.
pause
