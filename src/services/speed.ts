import { cmdTestDownloadSpeed } from "./cmds";

interface SpeedInfo {
  [group: string]: Record<string, [number, number]>; // [speed, timestamp]
}

const hashKey = (name: string, group: string) => `${group ?? ""}::${name}`;

class SpeedManager {
  private cache = {} as SpeedInfo;
  private listeners: (() => void)[] = [];
  // 每个item的监听
  private listenerMap = new Map<string, (speed: number) => void>();

  setSpeed(group: string, name: string, speed: number) {
    if (!this.cache[group]) this.cache[group] = {};
    this.cache[group][name] = [speed, Date.now()];
    console.log(`[SpeedManager] 设置速度缓存: ${name} = ${speed} bps`);
    
    // 触发特定项目的监听器
    const key = hashKey(name, group);
    const listener = this.listenerMap.get(key);
    if (listener) {
      listener(speed);
    }
    
    this.emit();
  }

  getSpeed(group: string, name: string) {
    const val = this.cache[group]?.[name];
    if (!val) return null;

    // 永久缓存，直到用户主动重新测试
    return val[0];
  }

  setItemListener(name: string, group: string, listener: (speed: number) => void) {
    const key = hashKey(name, group);
    this.listenerMap.set(key, listener);
  }

  removeItemListener(name: string, group: string) {
    const key = hashKey(name, group);
    this.listenerMap.delete(key);
  }

  getSpeedFix(proxy: IProxyItem, groupName: string): number {
    const { name, fixed } = proxy;
    if (fixed) return -2; // 固定节点
    return this.getSpeed(groupName, name) ?? -1; // -1 表示未测试
  }

  addListener(fn: () => void) {
    this.listeners.push(fn);
  }

  removeListener(fn: () => void) {
    const index = this.listeners.indexOf(fn);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  clearSpeed(group: string, name: string) {
    if (this.cache[group]) {
      delete this.cache[group][name];
      console.log(`[SpeedManager] 清除速度缓存: ${name}`);
      this.emit();
    }
  }

  removeGroupListener(groupName: string) {
    delete this.cache[groupName];
    this.emit();
  }

  async checkDownloadSpeed(
    group: string,
    proxyName: string,
    skipLoadingState = false
  ): Promise<void> {
    console.log(`[SpeedManager] 开始测试下载速度: group=${group}, proxy=${proxyName}`);
    
    // 开始测试前先设置为加载状态，这会触发UI更新（除非跳过）
    if (!skipLoadingState) {
      this.setSpeed(group, proxyName, -2);
    }
    
    try {
      console.log(`[SpeedManager] 调用后端命令: cmdTestDownloadSpeed(${proxyName})`);
      const result = await cmdTestDownloadSpeed(proxyName);
      console.log(`[SpeedManager] 后端返回结果:`, result);
      this.setSpeed(group, proxyName, result);
      console.log(`[SpeedManager] 设置速度完成: ${result}`);
    } catch (err: any) {
      console.error(`[SpeedManager] 测试 ${proxyName} 下载速度失败:`, err);
      this.setSpeed(group, proxyName, 0); // 0 表示错误
    }
  }

  async checkGroupSpeed(
    groupName: string,
    proxyNames: string[]
  ): Promise<void> {
    console.log(`[SpeedManager] 开始批量测试下载速度: group=${groupName}, count=${proxyNames.length}`);
    
    // 先将所有代理设置为加载状态
    proxyNames.forEach(name => {
      this.setSpeed(groupName, name, -2);
    });

    // 限制并发数量，避免过多并发请求
    const concurrency = 6;
    const chunks = [];
    for (let i = 0; i < proxyNames.length; i += concurrency) {
      chunks.push(proxyNames.slice(i, i + concurrency));
    }

         // 分批执行测试
     for (const chunk of chunks) {
       const promises = chunk.map((name) =>
         this.checkDownloadSpeed(groupName, name, true).catch((err) => {
           console.error(`[SpeedManager] 批量测试 ${name} 失败:`, err);
           this.setSpeed(groupName, name, 0);
         })
       );
       await Promise.all(promises);
     }
    
    console.log(`[SpeedManager] 批量测试完成: group=${groupName}`);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

export default new SpeedManager(); 