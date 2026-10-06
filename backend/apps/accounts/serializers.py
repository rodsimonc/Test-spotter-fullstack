from __future__ import annotations

from typing import Any

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import serializers

from apps.common.fields import CleanCharField

from .models import User

EMAIL_MAX = 254
PASSWORD_MAX = 128
NAME_MAX = 120
EMAIL_TAKEN = "An account with this email already exists."


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "name"]
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(
        max_length=EMAIL_MAX,
        error_messages={
            "required": "Enter your email.",
            "blank": "Enter your email.",
            "null": "Enter your email.",
            "invalid": "Enter a valid email address.",
            "max_length": f"Use at most {EMAIL_MAX} characters.",
        },
    )
    password = serializers.CharField(
        write_only=True,
        trim_whitespace=False,
        max_length=PASSWORD_MAX,
        error_messages={
            "required": "Choose a password.",
            "blank": "Choose a password.",
            "null": "Choose a password.",
            "max_length": f"Use at most {PASSWORD_MAX} characters.",
        },
    )
    name = CleanCharField(
        required=False,
        allow_blank=True,
        max_length=NAME_MAX,
        error_messages={"max_length": f"Use at most {NAME_MAX} characters."},
    )

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError(EMAIL_TAKEN)
        return email

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        candidate = User(email=attrs["email"], name=attrs.get("name", ""))
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from None
        return attrs

    def create(self, validated_data: dict[str, Any]) -> User:
        try:
            return User.objects.create_user(
                email=validated_data["email"],
                password=validated_data["password"],
                name=validated_data.get("name", ""),
            )
        except IntegrityError:
            # Two sign-ups for one address raced past the check above.
            raise serializers.ValidationError({"email": [EMAIL_TAKEN]}) from None


class LoginSerializer(serializers.Serializer):
    # Deliberately no email format check. Every bad credential gets the same answer.
    email = serializers.CharField(
        max_length=EMAIL_MAX,
        error_messages={
            "required": "Enter your email.",
            "blank": "Enter your email.",
            "null": "Enter your email.",
            "max_length": "Email or password is incorrect.",
        },
    )
    password = serializers.CharField(
        trim_whitespace=False,
        max_length=PASSWORD_MAX,
        error_messages={
            "required": "Enter your password.",
            "blank": "Enter your password.",
            "null": "Enter your password.",
            "max_length": "Email or password is incorrect.",
        },
    )
