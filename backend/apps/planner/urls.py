from django.urls import path

from . import views

urlpatterns = [
    path("health", views.HealthView.as_view(), name="health"),
    path("geocode/search", views.GeocodeSearchView.as_view(), name="geocode-search"),
    path("geocode/reverse", views.GeocodeReverseView.as_view(), name="geocode-reverse"),
    path("plan", views.PlanView.as_view(), name="plan"),
]
