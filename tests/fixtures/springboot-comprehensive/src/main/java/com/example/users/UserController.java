package com.example.users;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping
    public List<User> list() { return List.of(); }

    @PostMapping
    public User create(@RequestBody @Valid User body) { return body; }

    @GetMapping("/{id}")
    public User show(@PathVariable String id) { return new User(); }

    @PutMapping("/{id}")
    public User update(@PathVariable String id, @RequestBody @Valid User body) { return body; }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable String id) {}
}