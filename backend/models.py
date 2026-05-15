from datetime import datetime
from typing import Optional
from enum import Enum
from pydantic import BaseModel, Field


class EventType(str, Enum):
    career = "career"
    travel = "travel"
    milestone = "milestone"
    family = "family"


class LocationDetail(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class EventBase(BaseModel):
    title: str
    description: Optional[str] = None
    event_type: EventType
    date: datetime
    end_date: Optional[datetime] = None
    location: Optional[LocationDetail] = None
    tags: Optional[list[str]] = []
    people: Optional[list[str]] = []


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[EventType] = None
    date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    location: Optional[LocationDetail] = None
    tags: Optional[list[str]] = None
    people: Optional[list[str]] = None


class Event(EventBase):
    id: str = Field(alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


class PersonBase(BaseModel):
    name: str
    color: str  # palette key: blue, emerald, violet, amber, rose, cyan, fuchsia, lime, orange, slate


class PersonCreate(PersonBase):
    pass


class PersonUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class Person(PersonBase):
    id: str = Field(alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}
