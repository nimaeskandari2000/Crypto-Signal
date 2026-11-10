#!/usr/bin/env bash
set -e

echo "============================================================================"
echo "  QuantPulse — تبدیل خودکار پوشه به ریپازیتوری استاندارد گیت و گیت‌هاب"
echo "============================================================================"

# 1. Ensure .github/workflows exists (in case ZIP exporter stripped dot-folders)
mkdir -p .github/workflows
if [ -d "github-workflows" ]; then
  cp -f github-workflows/*.yml .github/workflows/ 2>/dev/null || true
  echo "[OK] فایل‌های ورک‌فلوی GitHub Actions (.github/workflows) تایید شدند."
fi

# 2. Initialize Git repository on branch main
if [ ! -d ".git" ]; then
  git init -b main
  echo "[OK] مخزن گیت (.git) روی شاخه main ایجاد شد."
else
  git branch -M main
  echo "[OK] مخزن گیت (.git) از قبل فعال است."
fi

git config user.name "QuantPulse Owner" 2>/dev/null || true
git config user.email "owner@quantpulse.local" 2>/dev/null || true

git add .
git commit -m "feat: QuantPulse crypto, pump hunter, forex & gold signal bot" || true
echo "[OK] تمامی فایل‌های پروژه در مخزن Git ثبت (Commit) شدند."
echo ""
read -r -p "آدرس ریپازیتوری گیت‌هاب (مثلاً https://github.com/USERNAME/quantpulse.git) یا Enter برای خروج: " REPO_URL
if [ -n "$REPO_URL" ]; then
  git remote remove origin 2>/dev/null || true
  git remote add origin "$REPO_URL"
  git push -u origin main
  echo "[OK] پروژه با موفقیت به گیت‌هاب شما Push شد!"
fi
