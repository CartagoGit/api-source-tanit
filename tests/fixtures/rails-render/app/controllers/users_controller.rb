class UsersController < ApplicationController
  def index
    render json: { id: 1, name: "Ada" }
  end

  def show
    render json: @user
  end

  def create
    render json: { id: 2 }, status: :created
  end

  def destroy
    head :no_content
  end
end
