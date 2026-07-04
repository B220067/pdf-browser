"""Builds e2e/encrypted-owner.pdf: opens with NO password (empty user
password) but has owner-password permission restrictions (no printing, no
modification) — the classic "encrypted but viewable" case the app must warn
about before stripping on export.
"""
from pypdf import PdfReader, PdfWriter
import os

here = os.path.dirname(os.path.abspath(__file__))
reader = PdfReader(os.path.join(here, "sample.pdf"))
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)

writer.encrypt(user_password="", owner_password="ownersecret", permissions_flag=0)

out_path = os.path.join(here, "encrypted-owner.pdf")
with open(out_path, "wb") as f:
    writer.write(f)
print("wrote", out_path)
