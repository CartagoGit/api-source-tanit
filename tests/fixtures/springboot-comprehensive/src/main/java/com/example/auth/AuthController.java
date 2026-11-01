package com.example.auth;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @PostMapping("/login")
    public String login(@RequestBody @Valid LoginRequest body) { return "fake-token"; }

    @PostMapping("/logout")
    public void logout() {}
}