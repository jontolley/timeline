from datetime import datetime
from typing import Optional
from enum import Enum
from pydantic import BaseModel, Field


# event_type is now a free-form string validated against the categories
# collection at write time. The five legacy values (career, travel, milestone,
# family, adventure) are seeded as defaults on startup.

class LocationDetail(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class MediaKind(str, Enum):
    photo = "photo"
    video = "video"
    audio = "audio"


class MediaRef(BaseModel):
    kind: MediaKind = MediaKind.photo
    key: str
    thumb_key: Optional[str] = None  # photo thumbnail or video poster frame; absent for audio
    content_type: str
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[float] = None  # set for video/audio
    uploaded_at: Optional[datetime] = None


class EventBase(BaseModel):
    title: str
    description: Optional[str] = None
    event_type: str
    date: datetime
    end_date: Optional[datetime] = None
    location: Optional[LocationDetail] = None
    tags: Optional[list[str]] = []
    people: Optional[list[str]] = []
    media: Optional[list[MediaRef]] = []
    # thread_id is required for new events; the route layer defaults it to the
    # user's first thread if the client doesn't specify one.
    thread_id: Optional[str] = None


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[str] = None
    date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    location: Optional[LocationDetail] = None
    tags: Optional[list[str]] = None
    people: Optional[list[str]] = None
    thread_id: Optional[str] = None


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


# Multi-user identity. `role` gates admin-only endpoints (Users tab, system
# config). One admin is seeded on the first multi-user migration; everyone
# else is created via invite.
class UserRole(str, Enum):
    admin = "admin"
    user = "user"


class UserBase(BaseModel):
    email: str
    role: UserRole = UserRole.user
    # Populated for Google-OAuth users from id_token claims; null for
    # magic-link users (the UI falls back to an initial avatar in that case).
    name: Optional[str] = None
    picture_url: Optional[str] = None


class UserCreate(BaseModel):
    email: str
    role: UserRole = UserRole.user


class UserUpdate(BaseModel):
    role: Optional[UserRole] = None


class User(UserBase):
    id: str = Field(alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


class CategoryBase(BaseModel):
    # `name` is the slug stored on events as `event_type`. `label` is the
    # human-readable display name; `color` is a palette key matching colors.js.
    name: str
    label: str
    color: str


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None


class Category(CategoryBase):
    id: str = Field(alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


# A thread is a private grouping of events owned by one user. In Phase 2,
# every event belongs to exactly one thread and threads are owner-scoped
# (no sharing yet — that's Phase 3).
class ThreadVisibility(str, Enum):
    private = "private"
    shared = "shared"


class ThreadBase(BaseModel):
    name: str
    color: str  # palette key
    visibility: ThreadVisibility = ThreadVisibility.private


class ThreadCreate(ThreadBase):
    pass


class ThreadUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    visibility: Optional[ThreadVisibility] = None


class Thread(ThreadBase):
    id: str = Field(alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}
