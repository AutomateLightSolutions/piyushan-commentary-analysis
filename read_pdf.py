import fitz
import sys

try:
    doc = fitz.open(r"d:\Test FYP\my_scope.pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    
    with open(r"d:\Test FYP\pdf_content.txt", "w", encoding="utf-8") as f:
        f.write(text)
    print("Successfully extracted PDF to pdf_content.txt")
except Exception as e:
    print(f"Error parsing PDF: {e}")
