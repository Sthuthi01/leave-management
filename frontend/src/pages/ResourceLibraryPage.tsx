import { useMemo, useState } from "react";
import { Button, Card, Empty, Input, Segmented, Space, Tag, Typography } from "antd";
import { DownloadOutlined, LinkOutlined, SearchOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type { OnboardingResource, ResourceCategory } from "../types";

const CATEGORY_LABELS: Record<ResourceCategory, string> = { GUIDE: "Guide", POLICY: "Policy", TRAINING: "Training" };

export function ResourceLibraryPage() {
  const [category, setCategory] = useState<"ALL" | ResourceCategory>("ALL");
  const [search, setSearch] = useState("");
  const resources = useQuery({ queryKey: ["onboarding-resources"], queryFn: () => api.get<OnboardingResource[]>("/onboarding/resources/") });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (resources.data ?? [])
      .filter((r) => category === "ALL" || r.category === category)
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  }, [resources.data, category, search]);

  const isFiltered = search.trim().length > 0 || category !== "ALL";
  const downloadUrl = (id: number) => `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8012/api"}/onboarding/resources/${id}/document/`;

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Resource Library
      </Typography.Title>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <Input.Search
          placeholder="Search resources..."
          allowClear
          style={{ width: 240 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          prefix={<SearchOutlined />}
        />
        <Segmented
          value={category}
          onChange={(v) => setCategory(v as "ALL" | ResourceCategory)}
          options={[
            { label: "All", value: "ALL" },
            { label: "Guides", value: "GUIDE" },
            { label: "Policies", value: "POLICY" },
            { label: "Training", value: "TRAINING" },
          ]}
        />
      </div>

      {!resources.isLoading && visible.length === 0 && (
        <Empty
          description={
            isFiltered ? (
              <>
                No resources found. Try a different search term, or switch to a different category.{" "}
                <a
                  onClick={() => {
                    setSearch("");
                    setCategory("ALL");
                  }}
                >
                  Clear filters
                </a>
              </>
            ) : (
              "No resources available yet."
            )
          }
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {visible.map((resource) => (
          <Card
            key={resource.id}
            title={resource.title}
            extra={<Tag>{CATEGORY_LABELS[resource.category]}</Tag>}
          >
            {resource.is_required && (
              <Tag color="red" style={{ marginBottom: 8 }}>
                Required
              </Tag>
            )}
            <Typography.Paragraph>{resource.description}</Typography.Paragraph>
            {resource.content && <Typography.Paragraph type="secondary">{resource.content}</Typography.Paragraph>}
            {resource.attachments.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {resource.attachments.map((attachment) => (
                  <div key={attachment.id}>
                    <a href={attachment.url} target="_blank" rel="noreferrer">
                      <LinkOutlined /> {attachment.name}
                    </a>
                  </div>
                ))}
              </div>
            )}
            <Space>
              {resource.url && (
                <Button icon={<LinkOutlined />} href={resource.url} target="_blank" rel="noreferrer">
                  Open link
                </Button>
              )}
              {resource.document && (
                <Button icon={<DownloadOutlined />} href={downloadUrl(resource.id)} target="_blank" rel="noreferrer">
                  {resource.document.file_name}
                </Button>
              )}
            </Space>
          </Card>
        ))}
      </div>
    </>
  );
}
