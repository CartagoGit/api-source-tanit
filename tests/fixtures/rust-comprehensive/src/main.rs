use actix_web::{get, post, put, delete, web, App, HttpServer, Responder};
use serde::Deserialize;
use validator::Validate;

#[derive(Deserialize, Validate)]
pub struct CreateUser {
    #[validate(length(min = 1, max = 100))]
    pub name: String,
    #[validate(email)]
    pub email: String,
    #[validate(range(min = 0, max = 120))]
    pub age: Option<i32>,
    #[serde(rename = "userRole")]
    pub role: String,
}

#[derive(Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 8))]
    pub password: String,
}

#[get("/health")]
async fn health() -> impl Responder {
    "ok"
}

#[get("/users")]
async fn list_users() -> impl Responder {
    web::Json(Vec::<String>::new())
}

#[post("/users")]
async fn create_user(body: web::Json<CreateUser>) -> impl Responder {
    web::Json(body.into_inner())
}

#[get("/users/{id}")]
async fn get_user(path: web::Path<i32>) -> impl Responder {
    web::Json(path.into_inner())
}

#[put("/users/{id}")]
async fn update_user(path: web::Path<i32>) -> impl Responder {
    "updated"
}

#[delete("/users/{id}")]
async fn delete_user(path: web::Path<i32>) -> impl Responder {
    "deleted"
}

#[post("/auth/login")]
async fn login(body: web::Json<LoginRequest>) -> impl Responder {
    "token"
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new().service(
            web::scope("/api")
                .service(health)
                .service(list_users)
                .service(create_user),
        )
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
