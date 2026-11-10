defmodule DemoWeb.Router do
  use DemoWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", DemoWeb do
    pipe_through :api

    get "/health", HealthController, :show

    scope "/v1" do
      resources "/users", UserController
      resources "/orders", OrderController, only: [:index, :show, :create]

      post "/auth/login", AuthController, :login
      post "/auth/logout", AuthController, :logout
      get "/users/:id/orders", UserController, :orders
    end
  end

  # get "/comentada", XController, :y
end
