from django.urls import include, path

urlpatterns = [
    path("api/", include("apps.planner.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.trips.urls")),
]

# Django looks these up on the root URLconf, not in settings. Without them an unknown URL or a
# crash outside the API views would answer with an HTML page instead of the JSON error body.
handler400 = "apps.common.views.bad_request"
handler403 = "apps.common.views.forbidden"
handler404 = "apps.common.views.not_found"
handler500 = "apps.common.views.server_error"
