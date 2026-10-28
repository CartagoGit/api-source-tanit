package com.example.demo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    @GetMapping
    public String list() {
        return "[]";
    }

    @PostMapping
    public String create(@RequestBody User user) {
        return "{}";
    }

    @GetMapping("/{id}")
    public String show(@PathVariable Long id) {
        return "{}";
    }

    @PutMapping("/{id}")
    public String update(@PathVariable Long id, @RequestBody User user) {
        return "{}";
    }

    @DeleteMapping("/{id}")
    public String delete(@PathVariable Long id) {
        return "{}";
    }
}

class User {
    public String name;
    public String email;
    public Integer age;
}
