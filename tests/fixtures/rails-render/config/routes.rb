Rails.application.routes.draw do
  namespace :api do
    resources :users
  end

  resources :posts
end
