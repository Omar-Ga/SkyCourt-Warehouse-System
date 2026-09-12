# -*- mode: python ; coding: utf-8 -*-
import certifi
import os


block_cipher = None

datas = [
    ('UI/dist', 'dist'),
    ('database/schema.sql', 'database'),
    ('database/migrations', 'database/migrations'),
    (certifi.where(), '.'),
]

if os.path.exists('.env'):
    datas.append(('.env', '.'))

a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[
        'dotenv',
        'libsql',
        'libsql_experimental',
        'certifi',
        'flask',
        'flask_cors',
        'werkzeug',
        'werkzeug.security',
        'app.staging',
        'app.migrations',
        'webview',
        'webview.platforms.winforms',
        'webview.platforms.edgechromium',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='WarehouseApp',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # Set to True if you want to see print() output for debugging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='UI/public/assets/favicon.ico',
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='WarehouseApp',
)
