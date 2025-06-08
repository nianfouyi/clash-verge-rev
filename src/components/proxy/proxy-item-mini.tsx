import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { CheckCircleOutlineRounded } from "@mui/icons-material";
import { alpha, Box, ListItemButton, styled, Typography } from "@mui/material";
import { BaseLoading } from "@/components/base";
import delayManager from "@/services/delay";
import speedManager from "@/services/speed";
import { useVerge } from "@/hooks/use-verge";
import { useTranslation } from "react-i18next";

interface Props {
  group: IProxyGroupItem;
  proxy: IProxyItem;
  selected: boolean;
  showType?: boolean;
  onClick?: (name: string) => void;
}

// 多列布局
export const ProxyItemMini = (props: Props) => {
  const { group, proxy, selected, showType = true, onClick } = props;

  const { t } = useTranslation();

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
    <ListItemButton
      dense
      selected={selected}
      onClick={() => onClick?.(proxy.name)}
      sx={[
        {
          height: 56,
          borderRadius: 1.5,
          pl: 1.5,
          pr: 1,
          justifyContent: "space-between",
          alignItems: "center",
        },
        ({ palette: { mode, primary } }) => {
          const bgcolor = mode === "light" ? "#ffffff" : "#24252f";
          const showDelay = delay > 0;
          const selectColor = mode === "light" ? primary.main : primary.light;

          return {
            "&:hover .the-check": { display: !showDelay ? "block" : "none" },
            "&:hover .the-speed-check": { display: speed <= 0 ? "block" : "none" },
            "&:hover .the-delay": { display: showDelay ? "block" : "none" },
            "&:hover .the-speed": { display: speed > 0 ? "block" : "none" },
            "&:hover .the-icon": { display: "none" },
            "& .the-pin, & .the-unpin": {
              position: "absolute",
              fontSize: "12px",
              top: "-5px",
              right: "-5px",
            },
            "& .the-unpin": { filter: "grayscale(1)" },
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
          };
        },
      ]}
    >
      <Box
        title={`${proxy.name}\n${proxy.now ?? ""}`}
        sx={{ overflow: "hidden" }}
      >
        <Typography
          variant="body2"
          component="div"
          color="text.primary"
          sx={{
            display: "block",
            textOverflow: "ellipsis",
            wordBreak: "break-all",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {proxy.name}
        </Typography>

        {showType && (
          <Box
            sx={{
              display: "flex",
              flexWrap: "nowrap",
              flex: "none",
              marginTop: "4px",
            }}
          >
            {proxy.now && (
              <Typography
                variant="body2"
                component="div"
                color="text.secondary"
                sx={{
                  display: "block",
                  textOverflow: "ellipsis",
                  wordBreak: "break-all",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  marginRight: "8px",
                }}
              >
                {proxy.now}
              </Typography>
            )}
            {!!proxy.provider && (
              <TypeBox color="text.secondary" component="span">
                {proxy.provider}
              </TypeBox>
            )}
            <TypeBox color="text.secondary" component="span">
              {proxy.type}
            </TypeBox>
            {proxy.udp && (
              <TypeBox color="text.secondary" component="span">
                UDP
              </TypeBox>
            )}
            {proxy.xudp && (
              <TypeBox color="text.secondary" component="span">
                XUDP
              </TypeBox>
            )}
            {proxy.tfo && (
              <TypeBox color="text.secondary" component="span">
                TFO
              </TypeBox>
            )}
            {proxy.mptcp && (
              <TypeBox color="text.secondary" component="span">
                MPTCP
              </TypeBox>
            )}
            {proxy.smux && (
              <TypeBox color="text.secondary" component="span">
                SMUX
              </TypeBox>
            )}
          </Box>
        )}
      </Box>
      <Box
        sx={{ ml: 0.5, color: "primary.main", display: isPreset ? "none" : "" }}
      >
        {(delay === -2 || speed === -2) && (
          <Widget>
            <BaseLoading />
          </Widget>
        )}
        {!proxy.provider && delay !== -2 && speed !== -2 && (
          // provider的节点不支持检测
          <Box sx={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <Widget
              className="the-check"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelay();
              }}
              sx={({ palette }) => ({
                display: "none", // hover才显示
                fontSize: "10px",
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
                fontSize: "10px",
                ":hover": { bgcolor: alpha(palette.success.main, 0.15) },
              })}
            >
              Speed
            </Widget>
          </Box>
        )}

        {(delay > 0 || speed > 0) && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-start" }}>
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
                        fontSize: "10px",
                        ":hover": { bgcolor: alpha(palette.primary.main, 0.15) } 
                      }
                    : { fontSize: "10px" }
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
                        fontSize: "10px",
                        ":hover": { bgcolor: alpha(palette.success.main, 0.15) } 
                      }
                    : { fontSize: "10px" }
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
            sx={{ fontSize: 16, mr: 0.5, display: "block" }}
          />
        )}
      </Box>
      {group.fixed && group.fixed === proxy.name && (
        // 展示fixed状态
        <span
          className={proxy.name === group.now ? "the-pin" : "the-unpin"}
          title={
            group.type === "URLTest" ? t("Delay check to cancel fixed") : ""
          }
        >
          📌
        </span>
      )}
    </ListItemButton>
  );
};

const Widget = styled(Box)(({ theme: { typography } }) => ({
  padding: "2px 4px",
  fontSize: 14,
  fontFamily: typography.fontFamily,
  borderRadius: "4px",
}));

const TypeBox = styled(Box, {
  shouldForwardProp: (prop) => prop !== "component",
})<{ component?: React.ElementType }>(({ theme: { palette, typography } }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: "text.secondary",
  color: "text.secondary",
  borderRadius: 4,
  fontSize: 10,
  fontFamily: typography.fontFamily,
  marginRight: "4px",
  marginTop: "auto",
  padding: "0 4px",
  lineHeight: 1.5,
}));
