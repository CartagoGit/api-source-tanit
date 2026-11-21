package com.example.users

import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/users")
class UserController {
    @GetMapping
    fun list(): List<Map<String, Any>> = emptyList()

    @PostMapping
    fun create(@RequestBody body: Map<String, Any>): Map<String, Any> = body

    @GetMapping("/{id}")
    fun show(@PathVariable id: String): Map<String, Any> = mapOf("id" to id)

    @DeleteMapping("/{id}")
    fun delete(@PathVariable id: String) {}
}
