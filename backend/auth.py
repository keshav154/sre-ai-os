import hashlib
import hmac
import os
import datetime
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from config import settings
from database import get_db
import models

PBKDF2_ITERATIONS = 260_000
JWT_ALGORITHM = "HS256"


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """PBKDF2-HMAC-SHA256 password hashing. Deliberately avoids bcrypt/passlib
    so auth doesn't depend on a compiled extension that can fail to install
    on some platforms — pbkdf2_hmac is stdlib and, at this iteration count,
    an accepted choice (it's what Django defaults to)."""
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return digest.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return hmac.compare_digest(candidate, password_hash)


def create_access_token(user_id: int) -> str:
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=settings.jwt_expires_minutes)
    payload = {"sub": str(user_id), "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except jwt.PyJWTError:
        return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> "models.User":
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = decode_access_token(auth_header[len("Bearer "):])
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
