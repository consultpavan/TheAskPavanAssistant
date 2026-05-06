import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "meeting_assistant")

class DataBase:
    client: AsyncIOMotorClient = None

db = DataBase()

async def connect_to_mongo():
    print(f"Connecting to MongoDB at {MONGODB_URL}...")
    db.client = AsyncIOMotorClient(MONGODB_URL)
    print("Connected to MongoDB!")

async def close_mongo_connection():
    if db.client is not None:
        print("Closing MongoDB connection...")
        db.client.close()
        print("Closed MongoDB connection!")

def get_database():
    return db.client[DATABASE_NAME]
