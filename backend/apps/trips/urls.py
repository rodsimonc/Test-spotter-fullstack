from django.urls import path

from . import views

urlpatterns = [
    path("trips", views.TripListCreateView.as_view(), name="trips"),
    path("trips/<uuid:pk>", views.TripDetailView.as_view(), name="trip-detail"),
]
