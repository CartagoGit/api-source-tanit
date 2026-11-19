module Api
  class UsersController < ApplicationController
    def index
      render json: { id: 1, name: "Ada", email: "ada@example.com" }
    end

    def show
      render json: @user
    end

    def create
      render json: { id: 2 }, status: :created
    end
  end
end
