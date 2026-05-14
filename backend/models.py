from datetime import datetime
from typing import Optional
from enum import Enum
from pydantic import BaseModel, Field


class EventType(str, Enum):
    career = "career"
    travel = "travel"
    milestone = "milestone"
    family = "family"


class EventBase(BaseModel):
    title: str
    description: Optional[str] = None
    event_type: EventType
    date: datetime
    location: Optional[str] = None
    tags: Optional[list[str]] = []


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[EventType] = None
    date: Optional[datetime] = None
    location: Optional[str] = None
    tags: Optional[list[str]] = None


class Event(EventBase):
    id: str = Field(alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}
