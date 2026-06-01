"""
Wand API - FastAPI Backend
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from dotenv import load_dotenv

load_dotenv()

from .routers import auth, jobs, cover_letters, news, ws, profile
from .database import engine, Base, ensure_sqlite_schema
from . import models  # Import models to register them

# Create all tables
Base.metadata.create_all(bind=engine)
ensure_sqlite_schema(engine)

app = FastAPI(
    title="Wand API",
    description="Resume analysis and job tracking platform",
    version="1.0.0"
)

# Session middleware for OAuth
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("JWT_SECRET_KEY", "change-me-in-production")
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded files (avatars, profile docs, etc.)
os.makedirs("api/uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="api/uploads"), name="uploads")

# Include routers
app.include_router(auth.router)
app.include_router(jobs.router)
app.include_router(cover_letters.router)
app.include_router(news.router)
app.include_router(ws.router)
app.include_router(profile.router)


# Health check
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {"message": "Wand API", "docs": "/docs"}
