import { useEffect, useMemo, useState } from "react";
import delayManager from "@/services/delay";
import speedManager from "@/services/speed";

// default | delay | alphabet | speed
export type ProxySortType = 0 | 1 | 2 | 3;

export default function useFilterSort(
  proxies: IProxyItem[],
  groupName: string,
  filterText: string,
  sortType: ProxySortType
) {
  const [refresh, setRefresh] = useState({});

  useEffect(() => {
    let last = 0;

    delayManager.setGroupListener(groupName, () => {
      // 简单节流
      const now = Date.now();
      if (now - last > 666) {
        last = now;
        setRefresh({});
      }
    });

    // 添加速度监听器
    const speedListener = () => {
      const now = Date.now();
      if (now - last > 666) {
        last = now;
        setRefresh({});
      }
    };
    
    speedManager.addListener(speedListener);

    return () => {
      delayManager.removeGroupListener(groupName);
      speedManager.removeListener(speedListener);
    };
  }, [groupName]);

  return useMemo(() => {
    const fp = filterProxies(proxies, groupName, filterText);
    const sp = sortProxies(fp, groupName, sortType);
    return sp;
  }, [proxies, groupName, filterText, sortType, refresh]);
}

export function filterSort(
  proxies: IProxyItem[],
  groupName: string,
  filterText: string,
  sortType: ProxySortType
) {
  const fp = filterProxies(proxies, groupName, filterText);
  const sp = sortProxies(fp, groupName, sortType);
  return sp;
}

/**
 * 可以通过延迟数/节点类型 过滤
 */
const regex1 = /delay([=<>])(\d+|timeout|error)/i;
const regex2 = /type=(.*)/i;

/**
 * filter the proxy
 * according to the regular conditions
 */
function filterProxies(
  proxies: IProxyItem[],
  groupName: string,
  filterText: string
) {
  if (!filterText) return proxies;

  const res1 = regex1.exec(filterText);
  if (res1) {
    const symbol = res1[1];
    const symbol2 = res1[2].toLowerCase();
    const value =
      symbol2 === "error" ? 1e5 : symbol2 === "timeout" ? 3000 : +symbol2;

    return proxies.filter((p) => {
      const delay = delayManager.getDelayFix(p, groupName);

      if (delay < 0) return false;
      if (symbol === "=" && symbol2 === "error") return delay >= 1e5;
      if (symbol === "=" && symbol2 === "timeout")
        return delay < 1e5 && delay >= 3000;
      if (symbol === "=") return delay == value;
      if (symbol === "<") return delay <= value;
      if (symbol === ">") return delay >= value;
      return false;
    });
  }

  const res2 = regex2.exec(filterText);
  if (res2) {
    const type = res2[1].toLowerCase();
    return proxies.filter((p) => p.type.toLowerCase().includes(type));
  }

  return proxies.filter((p) => p.name.includes(filterText.trim()));
}

/**
 * sort the proxy
 */
function sortProxies(
  proxies: IProxyItem[],
  groupName: string,
  sortType: ProxySortType
) {
  if (!proxies) return [];
  if (sortType === 0) return proxies;

  const list = proxies.slice();

  if (sortType === 1) {
    // 按延迟排序
    list.sort((a, b) => {
      const ad = delayManager.getDelayFix(a, groupName);
      const bd = delayManager.getDelayFix(b, groupName);

      if (ad === -1 || ad === -2) return 1;
      if (bd === -1 || bd === -2) return -1;

      return ad - bd;
    });
  } else if (sortType === 2) {
    // 按名称排序
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortType === 3) {
    // 按下载速度排序（速度快的排在前面）
    list.sort((a, b) => {
      const aSpeed = speedManager.getSpeedFix(a, groupName);
      const bSpeed = speedManager.getSpeedFix(b, groupName);

      // 处理特殊值：-2（固定节点）、-1（未测试）、0（错误）
      if (aSpeed === -2 && bSpeed === -2) return 0;
      if (aSpeed === -2) return -1; // 固定节点排在前面
      if (bSpeed === -2) return 1;
      
      if (aSpeed <= 0 && bSpeed <= 0) return 0; // 都是未测试或错误
      if (aSpeed <= 0) return 1; // 未测试的排在后面
      if (bSpeed <= 0) return -1;

      // 速度快的排在前面（降序）
      return bSpeed - aSpeed;
    });
  }

  return list;
}
