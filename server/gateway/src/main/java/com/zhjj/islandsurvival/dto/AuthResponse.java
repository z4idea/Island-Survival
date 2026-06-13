// @author: zhjj
package com.zhjj.islandsurvival.dto;

/** 注册/登录成功后返回：JWT + 基本身份信息。 */
public record AuthResponse(String token, Long accountId, String username) {}
