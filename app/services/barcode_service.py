import barcode
from barcode.writer import ImageWriter
import io
import base64
import os
import sys

def get_resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    if getattr(sys, 'frozen', False):
        base_path = sys._MEIPASS
    else:
        app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidate = os.path.join(app_dir, relative_path)
        if os.path.exists(candidate):
            return candidate
        root_dir = os.path.dirname(app_dir)
        candidate = os.path.join(root_dir, relative_path)
        if os.path.exists(candidate):
            return candidate
        base_path = os.path.abspath(".")

    direct = os.path.join(base_path, relative_path)
    if os.path.exists(direct):
        return direct
    app_rel = os.path.join(base_path, 'app', relative_path)
    if os.path.exists(app_rel):
        return app_rel
    return direct

def generate_barcode_base64(barcode_value):
    """
    Generates a barcode image for the given value and returns a dictionary with the base64 string.
    """
    try:
        font_path = get_resource_path(os.path.join('assets', 'arial.ttf'))
        Code128 = barcode.get_barcode_class('code128')
        code128 = Code128(barcode_value, writer=ImageWriter())
        
        buffer = io.BytesIO()
        code128.write(buffer, options={"font_path": font_path})
        buffer.seek(0)

        # Encode the image to Base64
        encoded_string = base64.b64encode(buffer.read()).decode('utf-8')

        return {
            "barcodeValue": barcode_value,
            "imageData": encoded_string,
            "imageFormat": "png"
        }
    except Exception as e:
        raise Exception(f"Error generating barcode for value {barcode_value}: {e}")
