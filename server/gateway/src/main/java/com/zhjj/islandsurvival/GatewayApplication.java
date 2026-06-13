// @author: zhjj
package com.zhjj.islandsurvival;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Island Survival 网关入口。
 * 联机改造第一步：账号注册/登录 + 云存档读写（替代前端 localStorage）。
 */
@SpringBootApplication
public class GatewayApplication {
    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
