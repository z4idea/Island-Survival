// @author: zhjj
package com.zhjj.islandsurvival.repository;

import com.zhjj.islandsurvival.entity.GameSave;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface GameSaveRepository extends JpaRepository<GameSave, Long> {
    Optional<GameSave> findByAccountId(Long accountId);
    void deleteByAccountId(Long accountId);
}
