import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { CheckCircleOutlineRounded } from "@mui/icons-material";
import {
  alpha,
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  styled,
  SxProps,
  Theme,
} from "@mui/material";
import { BaseLoading } from "@/components/base";
import delayManager from "@/services/delay";
import speedManager from "@/services/speed";
import { useVerge } from "@/hooks/use-verge";

interface Props {
  group: IProxyGroupItem;
  proxy: IProxyItem;
  selected: boolean;
  showType?: boolean;
  sx?: SxProps<Theme>;
  onClick?: (name: string) => void;
}

const Widget = styled(Box)(() => ({
  padding: "3px 6px",
  fontSize: 14,
  borderRadius: "4px",
}));

const TypeBox = styled("span")(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.text.secondary, 0.36),
  color: alpha(theme.palette.text.secondary, 0.42),
  borderRadius: 4,
  fontSize: 10,
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));

export const ProxyItem = (props: Props) => {
  const { group, proxy, selected, showType = true, sx, onClick } = props;

  const presetList = ["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"];
  const isPreset = presetList.includes(proxy.name);
  // -1/<=0 为 不显示
  // -2 为 loading
  const [delay, setDelay] = useState(-1);
  const [speed, setSpeed] = useState(-1);
  const { verge } = useVerge();
  const timeout = verge?.default_latency_timeout || 10000;
  useEffect(() => {
    if (isPreset) return;
    
    // 延迟监听器
    delayManager.setListener(proxy.name, group.name, setDelay);
    
    // 速度监听器 - 使用专门的item监听器
    speedManager.setItemListener(proxy.name, group.name, setSpeed);

    return () => {
      delayManager.removeListener(proxy.name, group.name);
      speedManager.removeItemListener(proxy.name, group.name);
    };
  }, [proxy.name, group.name]);

  useEffect(() => {
    if (!proxy) return;
    setDelay(delayManager.getDelayFix(proxy, group.name));
    setSpeed(speedManager.getSpeedFix(proxy, group.name));
  }, [proxy, group.name]);

  const onDelay = useLockFn(async () => {
    setDelay(-2);
    setDelay(await delayManager.checkDelay(proxy.name, group.name, timeout));
  });

  const onSpeed = useLockFn(async () => {
    console.log(`[ProxyItem] 点击Speed按钮: proxy=${proxy.name}, group=${group.name}`);
    // SpeedManager 会自动处理加载状态和结果更新
    await speedManager.checkDownloadSpeed(group.name, proxy.name);
  });

  // 格式化速度显示
  const formatSpeed = (speed: number): string => {
    if (speed <= 0) return "Error";
    if (speed < 1024) return `${speed}B/s`;
    if (speed < 1024 * 1024) return `${(speed / 1024).toFixed(1)}K/s`;
    if (speed < 1024 * 1024 * 1024) return `${(speed / (1024 * 1024)).toFixed(1)}M/s`;
    return `${(speed / (1024 * 1024 * 1024)).toFixed(1)}G/s`;
  };

  // 速度颜色
  const getSpeedColor = (speed: number): string => {
    if (speed <= 0) return "error";
    if (speed < 1024 * 1024) return "warning"; // < 1MB/s
    if (speed < 10 * 1024 * 1024) return "info"; // 1-10MB/s
    return "success"; // > 10MB/s
  };

  return (
    <ListItem sx={sx}>
      <ListItemButton
        dense
        selected={selected}
        onClick={() => onClick?.(proxy.name)}
        sx={[
          { borderRadius: 1 },
          ({ palette: { mode, primary } }) => {
            const bgcolor = mode === "light" ? "#ffffff" : "#24252f";
            const selectColor = mode === "light" ? primary.main : primary.light;
            const showDelay = delay > 0;

            return {
              "&:hover .the-check": { display: !showDelay ? "block" : "none" },
              "&:hover .the-speed-check": { display: speed <= 0 ? "block" : "none" },
              "&:hover .the-delay": { display: showDelay ? "block" : "none" },
              "&:hover .the-speed": { display: speed > 0 ? "block" : "none" },
              "&:hover .the-icon": { display: (showDelay || speed > 0) ? "none" : "none" },
              "&.Mui-selected": {
                width: `calc(100% + 3px)`,
                marginLeft: `-3px`,
                borderLeft: `3px solid ${selectColor}`,
                bgcolor:
                  mode === "light"
                    ? alpha(primary.main, 0.15)
                    : alpha(primary.main, 0.35),
              },
              backgroundColor: bgcolor,
              marginBottom: "8px",
              height: "40px",
            };
          },
        ]}
      >
        <ListItemText
          title={proxy.name}
          secondary={
            <>
              <Box
                sx={{
                  display: "inline-block",
                  marginRight: "8px",
                  fontSize: "14px",
                  color: "text.primary",
                }}
              >
                {proxy.name}
                {showType && proxy.now && ` - ${proxy.now}`}
              </Box>
              {showType && !!proxy.provider && (
                <TypeBox>{proxy.provider}</TypeBox>
              )}
              {showType && <TypeBox>{proxy.type}</TypeBox>}
              {showType && proxy.udp && <TypeBox>UDP</TypeBox>}
              {showType && proxy.xudp && <TypeBox>XUDP</TypeBox>}
              {showType && proxy.tfo && <TypeBox>TFO</TypeBox>}
              {showType && proxy.mptcp && <TypeBox>MPTCP</TypeBox>}
              {showType && proxy.smux && <TypeBox>SMUX</TypeBox>}
            </>
          }
        />

        <ListItemIcon
          sx={{
            justifyContent: "flex-end",
            color: "primary.main",
            display: isPreset ? "none" : "",
          }}
        >
          {(delay === -2 || speed === -2) && (
            <Widget>
              <BaseLoading />
            </Widget>
          )}

          {!proxy.provider && delay !== -2 && speed !== -2 && (
            // provider的节点不支持检测
            <Box sx={{ display: "flex", gap: "4px" }}>
              <Widget
                className="the-check"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelay();
                }}
                sx={({ palette }) => ({
                  display: "none", // hover才显示
                  fontSize: "12px",
                  ":hover": { bgcolor: alpha(palette.primary.main, 0.15) },
                })}
              >
                Delay
              </Widget>
              <Widget
                className="the-speed-check"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSpeed();
                }}
                sx={({ palette }) => ({
                  display: "none", // hover才显示
                  fontSize: "12px",
                  ":hover": { bgcolor: alpha(palette.success.main, 0.15) },
                })}
              >
                Speed
              </Widget>
            </Box>
          )}

                    {(delay > 0 || speed > 0) && (
            <Box sx={{ display: "flex", gap: "4px", alignItems: "center" }}>
              {delay > 0 && (
                // 显示延迟
                <Widget
                  className="the-delay"
                  onClick={(e) => {
                    if (proxy.provider) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onDelay();
                  }}
                  color={delayManager.formatDelayColor(delay, timeout)}
                  sx={({ palette }) =>
                    !proxy.provider
                      ? { 
                          fontSize: "12px",
                          ":hover": { bgcolor: alpha(palette.primary.main, 0.15) } 
                        }
                      : { fontSize: "12px" }
                  }
                >
                  {delayManager.formatDelay(delay, timeout)}
                </Widget>
              )}

              {speed > 0 && (
                // 显示速度
                <Widget
                  className="the-speed"
                  onClick={(e) => {
                    if (proxy.provider) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onSpeed();
                  }}
                  color={getSpeedColor(speed)}
                  sx={({ palette }) =>
                    !proxy.provider
                      ? { 
                          fontSize: "12px",
                          ":hover": { bgcolor: alpha(palette.success.main, 0.15) } 
                        }
                      : { fontSize: "12px" }
                  }
                >
                  {formatSpeed(speed)}
                </Widget>
              )}
            </Box>
          )}

          {delay !== -2 && delay <= 0 && selected && (
            // 展示已选择的icon
            <CheckCircleOutlineRounded
              className="the-icon"
              sx={{ fontSize: 16 }}
            />
          )}
        </ListItemIcon>
      </ListItemButton>
    </ListItem>
  );
};
