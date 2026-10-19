"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import AuthenticatedLayout from "../../../components/AuthenticatedLayout";
import { ApiError, requestJson } from "../../../lib/api";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string | null;
  organization: { name: string; type: string; verified: boolean } | null;
};

type AdminOrganization = {
  id: string;
  name: string;
  type: string;
  verified: boolean;
  verifiedAt: string | null;
  memberCount: number;
};

const PILOT_ROLES = ["ORGANIZER", "FUNDER", "VERIFIER"] as const;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [savingUserId, setSavingUserId] = useState("");
  const [savingOrganizationId, setSavingOrganizationId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersResponse, organizationsResponse] = await Promise.all([
        requestJson<{ users: AdminUser[] }>("/api/admin/users"),
        requestJson<{ organizations: AdminOrganization[] }>("/api/admin/organizations"),
      ]);
      setUsers(usersResponse.users);
      setOrganizations(organizationsResponse.organizations);
      setSelectedRoles(Object.fromEntries(usersResponse.users.map((user) => [user.id, user.role])));
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403
        ? "Halaman ini hanya tersedia untuk Admin."
        : "Daftar pengguna belum dapat dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveRole(user: AdminUser) {
    const role = selectedRoles[user.id];
    if (!role || role === user.role) return;
    setSavingUserId(user.id);
    setActionError("");
    setActionMessage("");
    const organization = organizations.find((item) => item.id === user.organizationId);
    const unverifiedFunderWarning = role === "FUNDER" && organization && !organization.verified
      ? "Perhatian: organisasi penerima role ini belum terverifikasi. Berikan dokumen pendukung sebelum campaign didanai. "
      : "";
    try {
      const response = await requestJson<{ user: AdminUser }>(`/api/admin/users/${user.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setUsers((current) => current.map((item) => item.id === user.id ? response.user : item));
      setSelectedRoles((current) => ({ ...current, [user.id]: response.user.role }));
      setActionMessage(`${unverifiedFunderWarning}Role berhasil diperbarui. ${user.name} perlu masuk kembali.`);
    } catch {
      setActionError("Role belum dapat diperbarui. Periksa koneksi dan coba lagi.");
    } finally {
      setSavingUserId("");
    }
  }

  async function setVerification(organization: AdminOrganization, verified: boolean) {
    setSavingOrganizationId(organization.id);
    setActionError("");
    setActionMessage("");
    try {
      const response = await requestJson<{ organization: AdminOrganization }>(`/api/admin/organizations/${organization.id}/verification`, {
        method: "PATCH",
        body: JSON.stringify({ verified }),
      });
      setOrganizations((current) => current.map((item) => item.id === organization.id ? response.organization : item));
      setUsers((current) => current.map((user) => user.organizationId === organization.id && user.organization
        ? { ...user, organization: { ...user.organization, verified: response.organization.verified } }
        : user));
      setActionMessage(verified
        ? `${organization.name} ditandai terverifikasi.`
        : `${organization.name} ditandai belum terverifikasi.`);
    } catch {
      setActionError("Status verifikasi belum dapat diperbarui. Periksa koneksi dan coba lagi.");
    } finally {
      setSavingOrganizationId("");
    }
  }

  return (
    <AuthenticatedLayout title="Pengguna dan role">
      {loading ? (
        <div className="workspace-loading" aria-busy="true">Memuat daftar pengguna…</div>
      ) : error ? (
        <div className="workspace-error"><p role="alert" aria-live="assertive">{error}</p><button className="action-button action-button--secondary" onClick={() => void load()}>Coba lagi</button></div>
      ) : users.length === 0 ? (
        <section className="workspace-empty"><h2>Belum ada pengguna</h2><p>Pengguna yang mendaftar akan muncul di sini.</p><Link href="/register">Daftarkan Organizer</Link></section>
      ) : (
        <>
          <p className="section-note">Role mengatur akses ke campaign dan bukti. Perubahan role mencabut sesi aktif pengguna tersebut.</p>
          <p className={actionMessage ? "workspace-success" : "visually-hidden"} role="status" aria-live="polite">{actionMessage}</p>
          <p className={actionError ? "workspace-error" : "visually-hidden"} role="alert" aria-live="assertive">{actionError}</p>
          <div className="table-scroll workspace-panel">
            <table className="workspace-table">
              <caption>Akun dan akses organisasi</caption>
              <thead><tr><th scope="col">Pengguna</th><th scope="col">Organisasi</th><th scope="col">Role</th><th scope="col">Aksi</th></tr></thead>
              <tbody>
                {users.map((user) => {
                  const organization = organizations.find((item) => item.id === user.organizationId);
                  const unverifiedFunder = user.role === "FUNDER" && organization && !organization.verified;
                  return (
                    <tr key={user.id}>
                      <th scope="row">{user.name}<br /><span className="table-meta">{user.email}</span></th>
                      <td>{user.organization
                        ? <>{user.organization.name} · {user.organization.type}{" "}<span className={user.organization.verified ? "status-pill status-pill--ok" : "status-pill status-pill--warning"}>{user.organization.verified ? "terverifikasi" : "belum terverifikasi"}</span></>
                        : "Tanpa organisasi"}</td>
                      <td>
                        {user.role === "ADMIN" ? <span className="status-pill status-pill--pending">ADMIN</span> : (
                          <label className="visually-hidden" htmlFor={`role-${user.id}`}>Role akun {user.name}</label>
                        )}
                        {user.role !== "ADMIN" && <select id={`role-${user.id}`} aria-label={`Role akun ${user.name}`} value={selectedRoles[user.id] ?? user.role} onChange={(event) => setSelectedRoles((current) => ({ ...current, [user.id]: event.target.value }))}>
                          {PILOT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>}
                        {unverifiedFunder && <p className="field-hint">Funder dari organisasi yang belum terverifikasi.</p>}
                      </td>
                      <td>{user.role === "ADMIN" ? <span className="table-meta">Role sistem</span> : <button className="action-button action-button--secondary" type="button" disabled={savingUserId === user.id || selectedRoles[user.id] === user.role} aria-busy={savingUserId === user.id} onClick={() => void saveRole(user)}>
                        {savingUserId === user.id ? "Menyimpan…" : `Simpan role ${user.name}`}
                      </button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-scroll workspace-panel">
            <table className="workspace-table">
              <caption>Verifikasi organisasi</caption>
              <thead><tr><th scope="col">Organisasi</th><th scope="col">Anggota</th><th scope="col">Status</th><th scope="col">Aksi</th></tr></thead>
              <tbody>
                {organizations.length === 0 ? (
                  <tr><td colSpan={4}>Belum ada organisasi terdaftar.</td></tr>
                ) : organizations.map((organization) => (
                  <tr key={organization.id}>
                    <th scope="row">{organization.name}<br /><span className="table-meta">{organization.type}</span></th>
                    <td>{organization.memberCount}</td>
                    <td><span className={organization.verified ? "status-pill status-pill--ok" : "status-pill status-pill--warning"}>{organization.verified ? "Terverifikasi" : "Belum terverifikasi"}</span></td>
                    <td><button className="action-button action-button--secondary" type="button" disabled={savingOrganizationId === organization.id} aria-busy={savingOrganizationId === organization.id} onClick={() => void setVerification(organization, !organization.verified)}>
                      {savingOrganizationId === organization.id ? "Menyimpan…" : organization.verified ? "Batalkan verifikasi" : "Tandai terverifikasi"}
                    </button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="section-note">Verifikasi organisasi adalah penilaian Admin atas dokumen pendukung lembaga. Status ini tercatat di audit log dan bisa dibatalkan.</p>
        </>
      )}
    </AuthenticatedLayout>
  );
}
