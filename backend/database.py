import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

client = AsyncIOMotorClient(MONGO_URL)
db = client.timeline_db
users_collection = db.users
events_collection = db.events
people_collection = db.people
threads_collection = db.threads
thread_subscriptions_collection = db.thread_subscriptions
auth_codes_collection = db.auth_codes
