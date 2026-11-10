#!/usr/bin/env python3
"""
Builds a complete, initialized GitHub Repository ZIP archive (`public/quantpulse-github-repo.zip`)
that includes the `.git/` directory (initialized on branch `main` with an initial commit) and
`.github/workflows/` (`scan.yml`, `daily.yml`, `weekly.yml`), while strictly excluding `.env` secrets,
`node_modules/`, `dist/`, and local caches.
"""
import os
import shutil
import subprocess
import zipfile

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKUP_WORKFLOWS_DIR = os.path.join(ROOT_DIR, "github-workflows")
DOT_WORKFLOWS_DIR = os.path.join(ROOT_DIR, ".github", "workflows")
OUTPUT_ZIP = os.path.join(ROOT_DIR, "public", "quantpulse-github-repo.zip")

EXCLUDE_DIRS = {
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".aistudio",
    "__pycache__",
}

EXCLUDE_FILES = {
    ".env",
    ".env.local",
    ".env.production",
    "bot_state_v4.json",
    "quantpulse-github-repo.zip",
    ".DS_Store",
}


def ensure_git_initialized():
    os.makedirs(BACKUP_WORKFLOWS_DIR, exist_ok=True)
    if os.path.isdir(DOT_WORKFLOWS_DIR):
        for fname in os.listdir(DOT_WORKFLOWS_DIR):
            if fname.endswith(".yml"):
                shutil.copy2(
                    os.path.join(DOT_WORKFLOWS_DIR, fname),
                    os.path.join(BACKUP_WORKFLOWS_DIR, fname),
                )

    subprocess.run(
        ["git", "config", "--global", "--add", "safe.directory", ROOT_DIR],
        cwd=ROOT_DIR,
        check=False,
    )
    git_dir = os.path.join(ROOT_DIR, ".git")
    if not os.path.isdir(git_dir):
        subprocess.run(["git", "init", "-b", "main"], cwd=ROOT_DIR, check=False)
    else:
        subprocess.run(["git", "branch", "-M", "main"], cwd=ROOT_DIR, check=False)

    subprocess.run(
        ["git", "config", "user.name", "QuantPulse Bot"], cwd=ROOT_DIR, check=False
    )
    subprocess.run(
        ["git", "config", "user.email", "bot@quantpulse.local"],
        cwd=ROOT_DIR,
        check=False,
    )
    subprocess.run(["git", "add", "."], cwd=ROOT_DIR, check=False)
    subprocess.run(
        [
            "git",
            "commit",
            "-m",
            "feat: QuantPulse crypto, pump hunter, forex & gold signal bot repository",
        ],
        cwd=ROOT_DIR,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def build_zip():
    os.makedirs(os.path.dirname(OUTPUT_ZIP), exist_ok=True)
    temp_zip = OUTPUT_ZIP + ".tmp"
    with zipfile.ZipFile(temp_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(ROOT_DIR):
            # Filter out excluded directories in-place (keep .git and .github!)
            dirnames[:] = [
                d
                for d in dirnames
                if d not in EXCLUDE_DIRS
            ]
            for filename in filenames:
                if filename in EXCLUDE_FILES or filename.endswith(".tmp"):
                    continue
                if filename.startswith(".env") and filename != ".env.example":
                    continue
                full_path = os.path.join(dirpath, filename)
                rel_path = os.path.relpath(full_path, ROOT_DIR)
                # Put everything inside a clean top-level folder `quantpulse-github-repo/`
                arcname = os.path.join("quantpulse-github-repo", rel_path)
                zf.write(full_path, arcname)
    os.replace(temp_zip, OUTPUT_ZIP)
    print(f"[OK] Built initialized GitHub repository ZIP: {OUTPUT_ZIP}")


if __name__ == "__main__":
    ensure_git_initialized()
    build_zip()
