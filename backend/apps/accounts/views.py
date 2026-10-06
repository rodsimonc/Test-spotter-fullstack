from __future__ import annotations

from typing import Any

from django.contrib.auth import authenticate, login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from apps.common.errors import InvalidCredentials
from apps.common.views import ApiView

from .models import User
from .serializers import LoginSerializer, RegisterSerializer, UserSerializer


def _start_session(request: Request, user: User) -> dict[str, Any]:
    """Sign the user in on a brand-new session, so a session id planted before login is useless."""
    request.session.flush()
    login(request, user)
    # Django rotates the CSRF secret at login, so the token the page fetched earlier is now stale.
    return {"user": UserSerializer(user).data, "csrf": get_token(request)}


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(ApiView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        return Response({"csrf": get_token(request)})


class MeView(ApiView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        user = request.user
        return Response({"user": UserSerializer(user).data if user.is_authenticated else None})


# Login and register run before any session exists, so DRF's session authentication has no
# CSRF check to make. `csrf_protect` adds it.
@method_decorator(csrf_protect, name="dispatch")
class RegisterView(ApiView):
    permission_classes = [AllowAny]
    throttle_scope = "register"

    def post(self, request: Request) -> Response:
        body = RegisterSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = body.save()
        return Response(_start_session(request, user), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(ApiView):
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request: Request) -> Response:
        body = LoginSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        # Django's backend hashes the password even when the email is unknown, so timing doesn't
        # reveal which emails have accounts.
        user = authenticate(request, email=body.validated_data["email"], password=body.validated_data["password"])
        if user is None:
            raise InvalidCredentials
        return Response(_start_session(request, user))


class LogoutView(ApiView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)
