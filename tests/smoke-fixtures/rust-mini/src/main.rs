use actix_web::{get, post, Responder};

#[get("/users")]
async fn list() -> impl Responder { "[]" }

#[post("/users")]
async fn create() -> impl Responder { "{}" }
