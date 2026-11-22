package com.example.users;

import jakarta.validation.constraints.*;

public class User {
    @NotBlank
    @Size(min = 1, max = 100)
    private String name;

    @NotBlank
    @Email
    private String email;

    @NotNull
    @Min(0)
    @Max(120)
    private Integer age;

    @NotBlank
    @Pattern(regexp = "admin|user|guest")
    private String role;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public Integer getAge() { return age; }
    public void setAge(Integer age) { this.age = age; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
}