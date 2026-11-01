package com.example.demo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    @GetMapping
    public String list() {
        return "[]";
    }

    @PostMapping
    public String create(@RequestBody Order order) {
        return "{}";
    }

    @GetMapping("/{id}")
    public String show(@PathVariable Long id) {
        return "{}";
    }
}

class Order {
    public String customerName;
    public String customerEmail;
    public Integer amount;
}
