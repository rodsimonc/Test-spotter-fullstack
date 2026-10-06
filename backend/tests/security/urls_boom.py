"""A URL configuration with one view that crashes outside DRF, to test Django's own 500 page."""

from django.urls import path

# The real handlers, taken from the project's URLconf so a missing hook there fails these tests.
from config.urls import handler400, handler403, handler404, handler500  # noqa: F401


def boom(request):
    raise RuntimeError("internal detail: postgres://user:hunter2@db.internal/prod")


urlpatterns = [path("boom", boom)]
