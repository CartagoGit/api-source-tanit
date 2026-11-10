Rails.application.routes.draw do
  # Health fuera de todo prefijo.
  get "/health", to: "health#show"

  namespace :api do
    namespace :v1 do
      # Siete acciones, de las que cinco tienen sentido en una API.
      resources :users

      # Acotado con only:
      resources :orders, only: [:index, :show, :create]

      # Recurso singular: sin index y sin :id.
      resource :profile, only: [:show, :update]

      post "/auth/login", to: "auth#login"
      post "/auth/logout", to: "auth#logout"
    end
  end

  # Una ruta comentada NO es una ruta.
  # get "/comentada", to: "x#y"
end
