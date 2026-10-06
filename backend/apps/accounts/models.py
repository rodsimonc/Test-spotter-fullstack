from __future__ import annotations

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    @staticmethod
    def normalize(email: str) -> str:
        return email.strip().lower()

    def _create(self, email: str, password: str | None, **extra) -> User:
        if not email:
            raise ValueError("An email address is required.")
        user = self.model(email=self.normalize(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra) -> User:
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra) -> User:
        extra["is_staff"] = True
        extra["is_superuser"] = True
        return self._create(email, password, **extra)

    def get_by_natural_key(self, email: str) -> User:
        return self.get(email=self.normalize(email))


class User(AbstractBaseUser, PermissionsMixin):
    """Email and password account. Emails are stored lowercased, which makes them unique
    regardless of how the person typed them."""

    email = models.EmailField(max_length=254, unique=True)
    name = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(email=Lower("email")), name="accounts_user_email_lowercase")
        ]

    def __str__(self) -> str:
        return self.email

    def save(self, *args, **kwargs) -> None:
        self.email = UserManager.normalize(self.email)
        super().save(*args, **kwargs)
