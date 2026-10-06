"""The User model: lowercase unique emails, hashed passwords and the manager's guard rails."""

from __future__ import annotations

import pytest
from django.contrib.auth import authenticate, get_user_model
from django.db import IntegrityError, transaction

from apps.accounts.models import User, UserManager
from apps.accounts.serializers import UserSerializer


def test_the_project_uses_the_custom_user_model():
    assert get_user_model() is User
    assert User.USERNAME_FIELD == "email"


def test_create_user_lowercases_and_trims_the_email():
    user = User.objects.create_user("  Mixed.Case@Example.COM ", "Zx9-battery-staple-42")
    assert user.email == "mixed.case@example.com"
    assert User.objects.get(pk=user.pk).email == "mixed.case@example.com"


def test_create_user_hashes_the_password():
    user = User.objects.create_user("a@example.com", "Zx9-battery-staple-42")
    assert user.password != "Zx9-battery-staple-42"
    assert user.check_password("Zx9-battery-staple-42")
    assert not user.check_password("zx9-battery-staple-42")


def test_a_user_without_a_password_cannot_sign_in():
    user = User.objects.create_user("a@example.com")
    assert not user.has_usable_password()


def test_create_user_defaults_to_an_ordinary_account():
    user = User.objects.create_user("a@example.com", "pw")
    assert user.is_active and not user.is_staff and not user.is_superuser and user.name == ""


def test_create_superuser_sets_the_flags():
    user = User.objects.create_superuser("root@example.com", "pw")
    assert user.is_staff and user.is_superuser


@pytest.mark.parametrize("email", ["", None])
def test_an_email_is_required(email):
    with pytest.raises((ValueError, AttributeError)):
        User.objects.create_user(email, "pw")


def test_emails_are_unique_whatever_the_case():
    User.objects.create_user("dana@example.com", "pw")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user("DANA@example.com", "pw")


def test_the_database_itself_refuses_an_uppercase_email():
    """Saving through the ORM lowercases, so only a raw update can slip one past the model."""
    user = User.objects.create_user("dana@example.com", "pw")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.filter(pk=user.pk).update(email="DANA@EXAMPLE.COM")


def test_save_lowercases_an_email_changed_after_creation():
    user = User.objects.create_user("dana@example.com", "pw")
    user.email = "Dana.New@Example.com"
    user.save()
    user.refresh_from_db()
    assert user.email == "dana.new@example.com"


def test_lookup_by_natural_key_ignores_case():
    user = User.objects.create_user("dana@example.com", "pw")
    assert User.objects.get_by_natural_key("DANA@Example.com") == user


def test_django_authenticate_accepts_any_case_for_the_email():
    user = User.objects.create_user("dana@example.com", "pw-1234-xyz")
    assert authenticate(email="Dana@EXAMPLE.com", password="pw-1234-xyz") == user
    assert authenticate(email="dana@example.com", password="nope") is None


def test_normalize_is_idempotent():
    assert UserManager.normalize(UserManager.normalize("  A@B.CO ")) == "a@b.co"


def test_str_is_the_email():
    assert str(User(email="dana@example.com")) == "dana@example.com"


def test_the_serializer_exposes_only_id_email_and_name():
    user = User.objects.create_user("dana@example.com", "pw", name="Dana")
    assert set(UserSerializer(user).data) == {"id", "email", "name"}


def test_name_length_is_capped_by_the_column():
    assert User._meta.get_field("name").max_length == 120
    assert User._meta.get_field("email").max_length == 254


def test_deleting_a_user_deletes_their_trips(rsps):
    from apps.trips.models import Trip

    user = User.objects.create_user("dana@example.com", "pw")
    Trip.objects.create(owner=user, title="t", request={}, result={}, summary={})
    user.delete()
    assert not Trip.objects.exists()
