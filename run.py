import sys
import os

# This is the crucial part for PyInstaller.
# It tells Python to look for modules in the current directory,
# which allows it to find the 'app' package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import start_app

if __name__ == '__main__':
    start_app() 