package com.keystone.admin;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.mybatis.spring.annotation.MapperScan;

@MapperScan({
        "com.keystone.system.mapper",
        "com.keystone.generator.mapper"
})
@SpringBootApplication(scanBasePackages = "com.keystone")
public class KeystoneAdminApplication {

    public static void main(String[] args) {
        SpringApplication.run(KeystoneAdminApplication.class, args);
    }
}
