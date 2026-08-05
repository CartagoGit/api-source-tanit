package com.example.users;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
public class UserController {
    @GetMapping
    public Object list() { return java.util.List.of(); }

    @PostMapping
    public Object create(@RequestBody Object body) { return body; }

    @GetMapping("/{id}")
    public Object show(@PathVariable String id) { return java.util.Map.of("id", id); }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable String id) {}
}
