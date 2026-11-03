defmodule MiniWeb.Router do
  scope "/" do
    get "/users", UserController, :index
    post "/users", UserController, :create
  end
end
