# Tiny app for the Task B check: `flask --app ../ledgerforge/demo/demo_app.py config`
# The values are fake on purpose; the command must print them as "***".
from flask import Flask

app = Flask(__name__)
app.config.update(SECRET_KEY="fake-secret", DB_PASSWORD="fake-password", API_TOKEN="fake-token", GREETING="hello")
