import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

data class User(val id: Int, val name: String)

fun main() {
    embeddedServer(Netty, port = 8080) {
        routing {
            get("/users") {
                val users = listOf(User(1, "Ada"))
                call.respond(HttpStatusCode.OK, users)
            }

            get("/users/{id}") {
                val id = call.parameters["id"]
                if (id == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@get
                }
                call.respond(HttpStatusCode.OK, User(id.toInt(), "Ada"))
            }

            post("/users") {
                call.respond(HttpStatusCode.Created, User(2, "Grace"))
            }

            delete("/users/{id}") {
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
