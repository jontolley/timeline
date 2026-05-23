import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

client = AsyncIOMotorClient(MONGO_URL)
db = client.timeline_db
events_collection = db.events
people_collection = db.people
categories_collection = db.categories
auth_codes_collection = db.auth_codes
