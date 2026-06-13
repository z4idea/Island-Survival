// @author: zhjj
package com.zhjj.islandsurvival.controller;

import com.zhjj.islandsurvival.security.JwtInterceptor;
import com.zhjj.islandsurvival.service.SaveService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Optional;

/**
 * 云存档：需登录（JwtInterceptor 已校验并注入 accountId）。
 * 对应前端原 localStorage 的 load / write / clear。
 */
@RestController
@RequestMapping("/api/save")
public class SaveController {

    private final SaveService saveService;

    public SaveController(SaveService saveService) {
        this.saveService = saveService;
    }

    /** 拉取存档：有则返回原始 JSON，无则 204（前端据此走"新游戏"）。 */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> load(@RequestAttribute(JwtInterceptor.ATTR_ACCOUNT_ID) Long accountId) {
        Optional<String> data = saveService.load(accountId);
        return data.map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** 上传/覆盖存档。请求体为整份 SaveData JSON。 */
    @PutMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> save(@RequestAttribute(JwtInterceptor.ATTR_ACCOUNT_ID) Long accountId,
                                     @RequestBody String rawJson) {
        saveService.save(accountId, rawJson);
        return ResponseEntity.ok().build();
    }

    /** 删除存档（对应前端 clearSave）。 */
    @DeleteMapping
    public ResponseEntity<Void> delete(@RequestAttribute(JwtInterceptor.ATTR_ACCOUNT_ID) Long accountId) {
        saveService.delete(accountId);
        return ResponseEntity.noContent().build();
    }
}
