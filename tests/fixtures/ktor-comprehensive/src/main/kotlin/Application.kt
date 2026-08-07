package com.example

import io.ktor.server.application.*
import io.ktor.server.routing.*

fun Application.configureRouting() {
    routing {
        get("/health") { }

        route("/api") {
            route("/users") {
                get { }
                post { }

                route("/{id}") {
                    get { }
                    put { }
                    delete { }
                }
            }

            post("/auth/login") { }
            // get("/comentada") { }
        }
    }
}
