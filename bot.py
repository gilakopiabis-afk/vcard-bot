import os
import json
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

service_account_info = json.loads(
    os.environ.get("GOOGLE_CREDENTIALS_JSON")
)

creds = Credentials.from_service_account_info(
    service_account_info,
    scopes=SCOPES
)
